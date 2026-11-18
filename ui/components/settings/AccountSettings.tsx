import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Failure } from "../../../shared/types/reader.types.ts";
import type { useAccount } from "../../hooks/use-account.ts";

interface AccountSettingsProps {
  account: ReturnType<typeof useAccount>;
  blocked: Failure | "";
  retry: () => void;
}

export function AccountSettings({ account, blocked, retry }: AccountSettingsProps) {
  const { session, busy, connect, disconnect } = account;
  const [failedPicture, setFailedPicture] = useState("");
  const picture = session?.picture;

  return (
    <fieldset disabled={busy}>
      <legend>ChatGPT 계정</legend>
      <div className="setting-row">
        <div className="account-summary">
          {session?.connected && (
            <span className="account-avatar" aria-hidden="true">
              {picture && picture !== failedPicture ? (
                <img
                  src={picture}
                  referrerPolicy="no-referrer"
                  alt=""
                  onError={() => setFailedPicture(picture)}
                />
              ) : (
                (session.label || "ChatGPT").charAt(0).toUpperCase()
              )}
            </span>
          )}
          <div>
            {session?.connected
              ? session.label || "ChatGPT 계정"
              : session?.pending
                ? "브라우저에서 로그인 중"
                : "한국어 번역"}
            <p className="setting-description">
              {session?.connected
                ? "번역에 이 계정의 플랜을 사용합니다."
                : "ChatGPT 플랜을 연결하면 글과 댓글을 번역합니다."}
            </p>
          </div>
        </div>
        {session?.pending ? (
          <Button variant="outline" onClick={disconnect}>
            연결 취소
          </Button>
        ) : session?.connected ? (
          <Button variant="outline" onClick={disconnect}>
            연결 해제
          </Button>
        ) : (
          <Button onClick={connect}>ChatGPT로 로그인</Button>
        )}
      </div>
      {session?.pending && session.url && (
        <a className="settings-link" href={session.url} target="_blank" rel="noreferrer">
          연결 화면 다시 열기 <ExternalLink size={14} />
        </a>
      )}
      {blocked && (
        <Button variant="ghost" size="sm" onClick={retry}>
          번역 다시 시도
        </Button>
      )}
    </fieldset>
  );
}
