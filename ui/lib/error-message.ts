export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "요청을 완료하지 못했습니다.";
