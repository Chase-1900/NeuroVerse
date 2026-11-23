import unicodedata
from datetime import UTC

from sqlalchemy import or_, select
from sqlalchemy.dialects.sqlite import insert

from app.core import APIError
from app.database import chunks, edges, graph_versions, node_sources, nodes


def normalize_title(title):
    return ' '.join(unicodedata.normalize('NFKC', title).split()).casefold()


def bump_version(connection, owner):
    stmt = insert(graph_versions).values(owner_id=owner, version=1)
    stmt = stmt.on_conflict_do_update(index_elements=[graph_versions.c.owner_id],
                                     set_={'version': graph_versions.c.version + 1})
    return connection.scalar(stmt.returning(graph_versions.c.version))


def iso_utc(value):
    return value.replace(tzinfo=UTC).isoformat().replace('+00:00', 'Z')


def node_dto(row, source_refs=()):
    return {**{key: row[key] for key in ('id', 'title', 'summary', 'category', 'kind', 'mastery')},
            'createdAt': iso_utc(row['created_at']), 'sourceRefs': list(source_refs)}


def edge_dto(row):
    return {'id': row['id'], 'source': row['source_id'], 'target': row['target_id'], 'relation': row['relation']}


def owned_node(conn, owner, identifier):
    row = conn.execute(select(nodes).where(nodes.c.owner_id == owner, nodes.c.id == identifier)).mappings().one_or_none()
    if row is None:
        raise APIError(404, 'NOT_FOUND', '节点不存在')
    return row


def graph_context(conn, owner, identifier):
    row = owned_node(conn, owner, identifier)
    sources = conn.execute(select(chunks.c.document_id, chunks.c.id, chunks.c.page, node_sources.c.snippet)
                           .join_from(node_sources, chunks, (chunks.c.id == node_sources.c.chunk_id) &
                                      (chunks.c.owner_id == node_sources.c.owner_id))
                           .where(node_sources.c.owner_id == owner, node_sources.c.node_id == identifier)
                           .order_by(chunks.c.document_id, chunks.c.ordinal, chunks.c.id).limit(3)).all()
    refs = [{'documentId': doc, 'chunkId': chunk, 'page': page, 'snippet': quote[:500]}
            for doc, chunk, page, quote in sources]
    relations = conn.execute(select(edges.c.source_id, edges.c.target_id).where(
        edges.c.owner_id == owner, or_(edges.c.source_id == identifier, edges.c.target_id == identifier))
        .order_by(edges.c.id).limit(10)).all()
    neighbor_ids = {b if a == identifier else a for a, b in relations}
    neighbors = conn.execute(select(nodes).where(nodes.c.owner_id == owner, nodes.c.id.in_(neighbor_ids))
                             .order_by(nodes.c.id).limit(5)).mappings()
    return {'node': node_dto(row, refs), 'sourceRefs': refs, 'neighbors': [node_dto(n) for n in neighbors]}
