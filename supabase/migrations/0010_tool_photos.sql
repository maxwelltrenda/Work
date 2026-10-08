-- Tool photos. Images live in a private Storage bucket; tools.photo_path
-- points at the current one. Anyone who can see tools can view photos;
-- only admins can add, replace or remove them.

alter table tools add column if not exists photo_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tool-photos', 'tool-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy tool_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'tool-photos' and can_see_tools());

-- "for all" covers adding, replacing and removing.
create policy tool_photos_admin on storage.objects for all to authenticated
  using (bucket_id = 'tool-photos' and is_team_admin())
  with check (bucket_id = 'tool-photos' and is_team_admin());
