-- 키프레임 이미지용 private 버킷 (업로드/삭제는 service_role 파이프라인만)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('keyframes', 'keyframes', false, 10485760, array['image/jpeg']) -- 10MB
on conflict (id) do nothing;

-- 본인 폴더({user_id}/...) 이미지 조회 허용 (에디터에서 signed URL 발급용)
create policy "keyframes bucket: 본인 폴더 조회"
on storage.objects for select to authenticated
using (
  bucket_id = 'keyframes'
  and (storage.foldername(name))[1] = auth.uid()::text
);
