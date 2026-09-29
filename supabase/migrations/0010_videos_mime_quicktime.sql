-- videos 버킷: 허용 MIME에 video/quicktime(.mov)·audio/m4a 추가 + 용량 한도 2GB → 500MB
-- (mov 미허용 시 업로드 거부, 브라우저별로 m4a가 audio/m4a로 올 수 있음.
--  500MB = 비용 상한 + 서버 메모리 보호, lib/upload-validate.ts MAX_UPLOAD_BYTES와 동일)
-- 재실행 안전: 이미 반영돼 있으면 변경 없음 (대시보드 수동 변경분과도 충돌 없음)
update storage.buckets
set allowed_mime_types = array_append(allowed_mime_types, 'video/quicktime')
where id = 'videos'
  and not ('video/quicktime' = any(allowed_mime_types));

update storage.buckets
set allowed_mime_types = array_append(allowed_mime_types, 'audio/m4a')
where id = 'videos'
  and not ('audio/m4a' = any(allowed_mime_types));

update storage.buckets
set file_size_limit = 524288000 -- 500MB
where id = 'videos';
