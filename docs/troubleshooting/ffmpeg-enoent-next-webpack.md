# ffmpeg ENOENT — Next.js webpack 번들링 문제

## 문제 상황
영상 업로드 시 서버에서 오류 발생:
```
spawn #ROOT\node_modules\ffmpeg-static\ffmpeg.exe ENOENT
```

## 시도한 것들
1. `ffmpeg-static` 바이너리 존재 확인 → 79MB, 정상 실행 가능
2. `npm rebuild ffmpeg-static` → 이미 정상
3. 경로 로그 추가 → Next.js 서버에서 `#ROOT` 플레이스홀더가 경로로 찍힘

## 원인
Next.js webpack이 `import("ffmpeg-static")`을 번들링할 때
바이너리 파일 경로(`C:\...\ffmpeg.exe`)를 실제로 임베드할 수 없어
`#ROOT/node_modules/...` 플레이스홀더로 교체.
런타임에 이 문자열 그대로 `execFile()`에 전달되어 ENOENT 발생.

## 최종 해결법
`next.config.ts`에 `serverExternalPackages` 추가:

```ts
const nextConfig: NextConfig = {
  serverExternalPackages: ["ffmpeg-static"],
};
```

Next.js가 `ffmpeg-static`을 webpack 번들에서 제외 →
Node.js `require()`가 직접 해석 → 실제 절대 경로 반환.

## 이력서 소재 한 줄
> Next.js webpack 번들링으로 인한 네이티브 바이너리 경로 플레이스홀더(`#ROOT`) 치환 문제를 `serverExternalPackages` 설정으로 해결, 영상 처리 파이프라인 정상화.
