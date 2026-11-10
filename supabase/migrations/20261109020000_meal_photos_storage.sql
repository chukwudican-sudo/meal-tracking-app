-- Meal photos in the cloud (Nov 9, 2026).
--
-- Before this the app stored only the photo's path on the phone (in its
-- temporary folder, which iOS can empty), so photos vanished after a reinstall,
-- on a second phone, or even on the same phone. Now a compressed JPEG
-- (~200 KB) is uploaded when the meal syncs, to a PRIVATE bucket:
--   meal-photos/<user id>/<meal id>-<hash of the local photo>.jpg
-- meal_logs.image_url holds "meal-photos/<that path>". The app shows it through
-- a short-lived signed URL. Only the owner can read or write their folder.
-- Deleting the account removes the folder first (delete-account function).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('meal-photos', 'meal-photos', false, 2097152, array['image/jpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- The first folder of the object name must be the caller's own user id.
drop policy if exists meal_photos_select_own on storage.objects;
create policy meal_photos_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'meal-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists meal_photos_insert_own on storage.objects;
create policy meal_photos_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'meal-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists meal_photos_update_own on storage.objects;
create policy meal_photos_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'meal-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'meal-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists meal_photos_delete_own on storage.objects;
create policy meal_photos_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'meal-photos' and (storage.foldername(name))[1] = auth.uid()::text);
