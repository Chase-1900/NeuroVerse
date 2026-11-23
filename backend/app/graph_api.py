from collections import defaultdict
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, ConfigDict, StringConstraints, model_validator
from sqlalchemy import and_, delete, insert, select, update

from app.core import APIError, session_owner, utc_now
from app.database import chunks, documents, edges, graph_versions, node_sources, nodes
from app.graph_store import bump_version, edge_dto, iso_utc, node_dto, normalize_title, owned_node

router = APIRouter(prefix='/api/v1')
Owner = Annotated[str, Depends(session_owner)]
Title = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=120)]
Summary = Annotated[str, StringConstraints(strict=True, max_length=1000)]
Category = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=80)]


class NodeCreate(BaseModel):
    title: Title
    summary: Summary
    category: Category


class NodePatch(BaseModel):
    model_config = ConfigDict(extra='forbid')

    title: Title | None = None
    summary: Summary | None = None
    category: Category | None = None

    @model_validator(mode='after')
    def validate_patch(self):
        if not self.model_fields_set or any(getattr(self, key) is None for key in self.model_fields_set):
            raise ValueError('Provide at least one non-null node field')
        return self


def _source_refs(connection, owner, node_id=None):
    # Graph/CRUD return full provenance, unlike the bounded model context.
    stmt = select(node_sources.c.node_id, chunks.c.document_id, chunks.c.id, chunks.c.page, node_sources.c.snippet)
    stmt = stmt.join_from(node_sources, chunks, and_(
        chunks.c.owner_id == node_sources.c.owner_id, chunks.c.id == node_sources.c.chunk_id,
    )).where(node_sources.c.owner_id == owner).order_by(chunks.c.document_id, chunks.c.ordinal, chunks.c.id)
    if node_id is not None:
        stmt = stmt.where(node_sources.c.node_id == node_id)
    refs = defaultdict(list)
    for identifier, doc, chunk, page, snippet in connection.execute(stmt):
        refs[identifier].append({'documentId': doc, 'chunkId': chunk, 'page': page, 'snippet': snippet})
    return refs


def _validate_node_fields(fields):
    if 'title' in fields:
        normalized = normalize_title(fields['title'])
        if not normalized or '\0' in normalized:
            raise APIError(400, 'INVALID_INPUT', '节点标题无效')
        fields['norm_title'] = normalized
    if 'category' in fields and (not fields['category'].strip() or '\0' in fields['category']):
        raise APIError(400, 'INVALID_INPUT', '节点类别无效')


def _check_duplicate(connection, owner, category, normalized, exclude=None):
    stmt = select(nodes.c.id).where(
        nodes.c.owner_id == owner, nodes.c.category == category, nodes.c.norm_title == normalized,
    )
    if exclude is not None:
        stmt = stmt.where(nodes.c.id != exclude)
    if connection.scalar(stmt) is not None:
        raise APIError(409, 'CONFLICT', '同类别已存在同名节点')


def _document_dto(row):
    return {'documentId': row['id'], 'title': row['title'], 'createdAt': iso_utc(row['created_at'])}


@router.get('/graph')
def get_graph(request: Request, response: Response, owner: Owner):
    with request.app.state.engine.connect() as connection:
        # A real SQLite read transaction keeps all queries on the same snapshot.
        connection.exec_driver_sql('BEGIN')
        version = connection.scalar(select(graph_versions.c.version).where(graph_versions.c.owner_id == owner))
        refs = _source_refs(connection, owner)
        node_rows = connection.execute(select(nodes).where(nodes.c.owner_id == owner)
                                       .order_by(nodes.c.created_at, nodes.c.id)).mappings()
        graph_nodes = [node_dto(row, refs.get(row['id'], ())) for row in node_rows]
        edge_rows = connection.execute(select(edges).where(edges.c.owner_id == owner)
                                       .order_by(edges.c.id)).mappings()
        graph_edges = [edge_dto(row) for row in edge_rows]
    response.headers['Cache-Control'] = 'no-store'
    return {'nodes': graph_nodes, 'edges': graph_edges, 'graphVersion': version if version is not None else 0}


@router.post('/nodes', status_code=201)
def create_node(body: NodeCreate, request: Request, response: Response, owner: Owner):
    fields = body.model_dump()
    _validate_node_fields(fields)
    with request.app.state.engine.begin() as connection:
        connection.exec_driver_sql('BEGIN IMMEDIATE')
        _check_duplicate(connection, owner, fields['category'], fields['norm_title'])
        row = connection.execute(insert(nodes).values(
            id=str(uuid4()), owner_id=owner, kind='knowledge', mastery=0, created_at=utc_now(), **fields,
        ).returning(*nodes.c)).mappings().one()
        bump_version(connection, owner)
        result = node_dto(row)
    response.headers['Cache-Control'] = 'no-store'
    return {'node': result}


@router.patch('/nodes/{id}')
def patch_node(id: str, body: NodePatch, request: Request, response: Response, owner: Owner):
    fields = body.model_dump(exclude_unset=True)
    _validate_node_fields(fields)
    with request.app.state.engine.begin() as connection:
        connection.exec_driver_sql('BEGIN IMMEDIATE')
        current = owned_node(connection, owner, id)
        if 'norm_title' in fields or 'category' in fields:
            _check_duplicate(connection, owner, fields.get('category', current['category']),
                             fields.get('norm_title', current['norm_title']), exclude=id)
        row = connection.execute(update(nodes).where(nodes.c.owner_id == owner, nodes.c.id == id)
                                 .values(**fields).returning(*nodes.c)).mappings().one()
        bump_version(connection, owner)
        result = node_dto(row, _source_refs(connection, owner, id).get(id, ()))
    response.headers['Cache-Control'] = 'no-store'
    return {'node': result}


@router.delete('/nodes/{id}', status_code=204)
def delete_node(id: str, request: Request, owner: Owner):
    with request.app.state.engine.begin() as connection:
        connection.exec_driver_sql('BEGIN IMMEDIATE')
        # SQLite foreign keys handle dependent rows; source documents remain intact.
        deleted = connection.execute(delete(nodes).where(nodes.c.owner_id == owner, nodes.c.id == id)
                                     .returning(nodes.c.id)).scalar_one_or_none()
        if deleted is None:
            raise APIError(404, 'NOT_FOUND', '节点不存在')
        bump_version(connection, owner)
    return Response(status_code=204, headers={'Cache-Control': 'no-store'})


@router.get('/documents')
def list_documents(request: Request, response: Response, owner: Owner):
    with request.app.state.engine.connect() as connection:
        rows = connection.execute(select(documents).where(documents.c.owner_id == owner)
                                  .order_by(documents.c.created_at.desc(), documents.c.id)).mappings()
        result = [{**_document_dto(row), 'status': row['status']} for row in rows]
    response.headers['Cache-Control'] = 'no-store'
    return {'documents': result}


@router.get('/documents/{id}')
def get_document(id: str, request: Request, response: Response, owner: Owner):
    with request.app.state.engine.connect() as connection:
        connection.exec_driver_sql('BEGIN')
        row = connection.execute(select(documents).where(documents.c.owner_id == owner, documents.c.id == id)
                                 ).mappings().one_or_none()
        if row is None:
            raise APIError(404, 'NOT_FOUND', '资料不存在')
        chunk_rows = connection.execute(select(chunks.c.id, chunks.c.page, chunks.c.text)
                                        .where(chunks.c.owner_id == owner, chunks.c.document_id == id)
                                        .order_by(chunks.c.ordinal))
        result = {**_document_dto(row), 'chunks': [
            {'chunkId': chunk_id, 'page': page, 'text': text} for chunk_id, page, text in chunk_rows
        ]}
    response.headers['Cache-Control'] = 'no-store'
    return result
