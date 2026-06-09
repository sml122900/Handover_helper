-- 영상 업로드용 private 버킷
-- 업로드는 서버가 발급한 signed upload URL, 다운로드는 service_role(파이프라인)만.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'videos',
  'videos',
  false,
  2147483648, -- 2GB
  array['video/mp4', 'video/webm', 'audio/mp4', 'audio/x-m4a', 'text/plain', 'application/octet-stream']
)
on conflict (id) do nothing;

-- signed upload URL 사용 시에도 storage RLS가 적용되므로,
-- 본인 폴더({user_id}/...)에만 업로드 허용 정책을 추가한다.
create policy "videos bucket: 본인 폴더 업로드"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'videos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "videos bucket: 본인 폴더 조회"
on storage.objects for select to authenticated
using (
  bucket_id = 'videos'
  and (storage.foldername(name))[1] = auth.uid()::text
);
