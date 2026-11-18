import NumberFlow, { type NumberFlowProps } from "@number-flow/react";

type AnimatedCountProps = Pick<
  NumberFlowProps,
  "value" | "onAnimationsStart" | "onAnimationsFinish"
>;

export function AnimatedCount(props: AnimatedCountProps) {
  return <NumberFlow locales="ko" isolate {...props} />;
}
