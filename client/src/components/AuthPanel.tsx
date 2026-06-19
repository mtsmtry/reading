import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";

export function AuthPanel({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: auth } = useQuery({ queryKey: ["auth"], queryFn: api.auth });
  const [cookie, setCookie] = useState("");
  const [probeResult, setProbeResult] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: (c: string) => api.saveCookie(c),
    onSuccess: () => {
      setCookie("");
      qc.invalidateQueries({ queryKey: ["auth"] });
      qc.invalidateQueries({ queryKey: ["word"] });
    },
  });

  const clearMutation = useMutation({
    mutationFn: () => api.clearCookie(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auth"] }),
  });

  const probeMutation = useMutation({
    mutationFn: () => api.probe(),
    onSuccess: (r) =>
      setProbeResult(
        `HTTP ${r.status} / ${r.ok ? "接続OK" : "接続NG"} / ${
          r.loginRequired ? "ログインが必要な表示を検出" : "ログイン要求は検出されず"
        }`
      ),
    onError: (e: Error) => setProbeResult(`エラー: ${e.message}`),
  });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>kotobank ログイン設定 (Cookie)</h2>
          <button className="x" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="modal-body">
          <p className="status">
            現在の状態:{" "}
            {auth?.hasCookie ? (
              <span className="ok">Cookie 設定済み（{auth.cookiePreview}）</span>
            ) : (
              <span className="warn">未設定</span>
            )}
          </p>

          <ol className="howto">
            <li>ブラウザで <code>kotobank.jp</code> にログインします。</li>
            <li>
              開発者ツール（F12）→ Network タブで kotobank へのリクエストを選び、Request Headers の{" "}
              <code>Cookie</code> の値をコピーします。
            </li>
            <li>下の欄に貼り付けて保存します。値はこのローカルPC内のSQLiteにのみ保存されます。</li>
          </ol>

          <textarea
            className="cookie-input"
            placeholder="例: _kotobank_session=abc123; user_token=xyz; ..."
            value={cookie}
            onChange={(e) => setCookie(e.target.value)}
            rows={4}
          />

          <div className="modal-actions">
            <button
              className="primary"
              disabled={!cookie.trim() || saveMutation.isPending}
              onClick={() => saveMutation.mutate(cookie)}
            >
              {saveMutation.isPending ? "保存中…" : "Cookie を保存"}
            </button>
            <button
              disabled={!auth?.hasCookie || clearMutation.isPending}
              onClick={() => clearMutation.mutate()}
            >
              削除
            </button>
            <button onClick={() => probeMutation.mutate()} disabled={probeMutation.isPending}>
              {probeMutation.isPending ? "確認中…" : "接続テスト"}
            </button>
          </div>

          {saveMutation.isError && (
            <p className="error">保存失敗: {(saveMutation.error as Error).message}</p>
          )}
          {probeResult && <p className="probe">{probeResult}</p>}

          <p className="note">
            ※ ブリタニカの項目は通常ログイン不要で閲覧できますが、ログインが必要な表示が出る場合に
            この Cookie が使われます。
          </p>
        </div>
      </div>
    </div>
  );
}
