import { useContext } from "react";
import { Button } from "@/components/ui/button";
import { LanguageContext } from "../../contexts/language-context.ts";

export function LanguageButton() {
  const { bilingual, toggle } = useContext(LanguageContext);
  return (
    <Button size="sm" variant="ghost" aria-pressed={bilingual} onClick={toggle}>
      {bilingual ? "영문 숨기기" : "영문 함께 보기"}
    </Button>
  );
}
