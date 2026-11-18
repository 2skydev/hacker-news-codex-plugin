import { useEffect } from "react";
import { toast } from "sonner";
import type { useTranslation } from "./use-translation.ts";

const TOAST_ID = "reader-translation";

export function useTranslationToast(
  progress: ReturnType<typeof useTranslation>["progress"],
  settings: boolean,
) {
  useEffect(() => {
    if (!progress || settings) {
      toast.dismiss(TOAST_ID);
      return;
    }
    const { done, total } = progress;
    toast(`${done === total ? "번역 완료" : "번역 중"} ${done}/${total}`, {
      id: TOAST_ID,
      toasterId: "translation",
      duration: Infinity,
      dismissible: false,
      closeButton: false,
      icon: (
        <svg
          width="18"
          height="18"
          viewBox="0 0 20 20"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="-ml-1"
        >
          <circle cx="10" cy="10" r="8" opacity=".22" />
          {done > 0 && (
            <circle
              cx="10"
              cy="10"
              r="8"
              pathLength="100"
              strokeDasharray="100"
              strokeDashoffset={100 - (100 * done) / total}
              transform="rotate(-90 10 10)"
              strokeLinecap="round"
            />
          )}
        </svg>
      ),
    });
  }, [progress, settings]);
  useEffect(
    () => () => {
      toast.dismiss(TOAST_ID);
    },
    [],
  );
}
