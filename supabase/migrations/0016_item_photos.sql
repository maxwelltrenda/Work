-- Stock item photos, like tool photos. Stored as <item id>/<file>.jpg in a
-- private bucket; each role can view photos only for stock it can see, and
-- only admins can add, replace or remove them.

alter table items add column if not exists photo_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('item-photos', 'item-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy item_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'item-photos' and exists (
    select 1 from public.items i
     where i.id::text = (storage.foldername(name))[1] and public.can_see_stock(i.category)));

create policy item_photos_admin on storage.objects for all to authenticated
  using (bucket_id = 'item-photos' and public.is_team_admin())
  with check (bucket_id = 'item-photos' and public.is_team_admin());
