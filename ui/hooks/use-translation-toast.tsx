import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AnimatedCount } from "../components/AnimatedCount.tsx";
import type { useTranslation } from "./use-translation.ts";

const TOAST_ID = "reader-translation";

function TranslationCount({ done, complete }: { done: number; complete: boolean }) {
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    if (!complete || animating) return;
    const timer = setTimeout(() => toast.dismiss(TOAST_ID), 550);
    return () => clearTimeout(timer);
  }, [complete, animating]);

  return (
    <AnimatedCount
      value={done}
      onAnimationsStart={() => setAnimating(true)}
      onAnimationsFinish={() => setAnimating(false)}
    />
  );
}

export function useTranslationToast(
  progress: ReturnType<typeof useTranslation>["progress"],
  settings: boolean,
) {
  useEffect(() => {
    if (!progress || settings) {
      toast.dismiss(TOAST_ID);
      return;
    }
    const { done, total, startedAt } = progress;
    const complete = done === total;
    const label = complete ? "번역 완료" : "번역 중";
    const title = (
      <>
        <span className="sr-only">{`${label} ${done}/${total}`}</span>
        <span aria-hidden="true" className="tabular-nums">
          {label} <TranslationCount key={startedAt} done={done} complete={complete} />/{total}
        </span>
      </>
    );

    toast(title, {
      id: TOAST_ID,
      toasterId: "translation",
      duration: Infinity,
      dismissible: false,
      closeButton: false,
      icon: (
        <svg
          key={startedAt}
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
          <circle
            className="translation-progress"
            cx="10"
            cy="10"
            r="8"
            pathLength="100"
            strokeDasharray="100 110"
            strokeDashoffset={100 - (100 * done) / total}
            transform="rotate(-90 10 10)"
            strokeLinecap="round"
          />
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
