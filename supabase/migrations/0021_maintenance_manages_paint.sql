-- The Maintenance manager can add and edit paint colors (and their photos),
-- not just take and put back cans. Only paint: the row must be paint before
-- and after the change. Cans themselves still only change through paint_move.

create policy paint_insert on items for insert to authenticated
  with check (category = 'paint' and my_role() = 'maintenance');
create policy paint_update on items for update to authenticated
  using (category = 'paint' and my_role() = 'maintenance')
  with check (category = 'paint' and my_role() = 'maintenance');

create policy item_photos_paint on storage.objects for all to authenticated
  using (bucket_id = 'item-photos' and public.my_role() = 'maintenance' and exists (
    select 1 from public.items i where i.id::text = (storage.foldername(name))[1] and i.category = 'paint'))
  with check (bucket_id = 'item-photos' and public.my_role() = 'maintenance' and exists (
    select 1 from public.items i where i.id::text = (storage.foldername(name))[1] and i.category = 'paint'));
