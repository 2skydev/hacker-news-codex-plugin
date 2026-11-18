import { Tooltip } from "@base-ui/react/tooltip";
import { LanguagesIcon } from "lucide-react";
import { useContext, useId } from "react";
import { Button } from "@/components/ui/button";
import { LanguageContext } from "../../contexts/language-context.ts";

export function LanguageButton() {
  const { bilingual, toggle } = useContext(LanguageContext);
  const tooltipId = useId();

  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        delay={350}
        closeOnClick={false}
        render={
          <Button
            size="icon"
            variant={bilingual ? "secondary" : "ghost"}
            aria-label="영문 표시"
            aria-describedby={tooltipId}
            aria-pressed={bilingual}
            onClick={toggle}
          />
        }
      >
        <LanguagesIcon aria-hidden="true" />
      </Tooltip.Trigger>
      <Tooltip.Portal keepMounted>
        <Tooltip.Positioner side="bottom" sideOffset={6} className="z-50">
          <Tooltip.Popup
            id={tooltipId}
            role="tooltip"
            className="rounded-md bg-popover px-2 py-1 text-xs text-popover-foreground ring-1 ring-border shadow-popup"
          >
            {bilingual ? "영문 숨기기" : "영문 함께 보기"}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
