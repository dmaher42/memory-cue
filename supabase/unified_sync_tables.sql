-- Memory Cue unified Supabase sync tables
create table if not exists public.inbox (
  id uuid primary key,
  user_id uuid,
  text text,
  tags text[],
  source text,
  parsed_type text,
  metadata jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.reminders (
  id uuid primary key,
  user_id uuid,
  title text,
  notes text,
  priority text,
  category text,
  done boolean default false,
  due timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  order_index integer,
  metadata jsonb
);

create table if not exists public.chat_messages (
  id uuid primary key,
  user_id uuid,
  role text,
  content text,
  created_at timestamptz default now(),
  conversation_id text
);
