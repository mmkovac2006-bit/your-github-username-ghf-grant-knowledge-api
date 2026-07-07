create table if not exists grant_documents (
  path text primary key,
  source_file text not null,
  year text,
  funder text,
  document_type text not null default 'source_document',
  topic_tags text[] not null default '{}',
  server_modified timestamptz,
  client_modified timestamptz,
  size_bytes bigint,
  indexed_at timestamptz not null default now(),
  search_text tsvector generated always as (
    setweight(to_tsvector('english', coalesce(source_file, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(funder, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(document_type, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(array_to_string(topic_tags, ' '), '')), 'B') ||
    setweight(to_tsvector('english', coalesce(year, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(path, '')), 'C')
  ) stored
);

create table if not exists grant_chunks (
  chunk_id text primary key,
  path text not null references grant_documents(path) on delete cascade,
  chunk_index integer not null,
  heading text,
  text text not null,
  character_count integer not null,
  search_text tsvector generated always as (
    setweight(to_tsvector('english', coalesce(heading, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(text, '')), 'B')
  ) stored
);

create index if not exists grant_documents_search_idx on grant_documents using gin(search_text);
create index if not exists grant_chunks_search_idx on grant_chunks using gin(search_text);
create index if not exists grant_chunks_path_idx on grant_chunks(path);
create index if not exists grant_documents_year_idx on grant_documents(year);
create index if not exists grant_documents_funder_idx on grant_documents(funder);
create index if not exists grant_documents_document_type_idx on grant_documents(document_type);
