# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

import hashlib
import json

from genlayer import *

MAX_SNIPPET_CHARS = 3000


def _slice_snippet(raw_text: str, start_line: int, end_line: int) -> tuple[str, str]:
    normalized = raw_text.replace("\r\n", "\n").replace("\r", "\n")
    lines = normalized.split("\n")
    if start_line < 1 or end_line < start_line or start_line > len(lines):
        return "", ""
    selected = lines[start_line - 1 : min(end_line, len(lines))]
    snippet = " ".join(" ".join(selected).split())[:MAX_SNIPPET_CHARS]
    snippet_sha256 = hashlib.sha256(snippet.encode("utf-8")).hexdigest()
    return snippet, snippet_sha256


class EvidenceProbe(gl.Contract):
    last_probe_json: str

    def __init__(self) -> None:
        self.last_probe_json = "{}"

    @gl.public.write
    def probe_url_slice(self, url: str, start_line: int, end_line: int) -> str:
        clean_url = str(url).strip()
        s_line = int(start_line)
        e_line = int(end_line)

        def leader_fn() -> dict:
            resp = gl.nondet.web.get(clean_url)
            status = int(resp.status)
            if status != 200:
                return {
                    "ok": False,
                    "http_status": status,
                    "probe_url": clean_url,
                    "snippet_sha256": "",
                    "snippet_len": 0,
                    "snippet_preview": "",
                }
            raw_text = resp.body.decode("utf-8", errors="replace")
            snippet, snippet_sha256 = _slice_snippet(raw_text, s_line, e_line)
            return {
                "ok": True,
                "http_status": status,
                "probe_url": clean_url,
                "snippet_sha256": snippet_sha256,
                "snippet_len": len(snippet),
                "snippet_preview": snippet[:240],
            }

        def validator_fn(leaders_res: gl.vm.Result) -> bool:
            if not isinstance(leaders_res, gl.vm.Return):
                return False
            leader_data = leaders_res.calldata
            if not isinstance(leader_data, dict):
                return False

            resp = gl.nondet.web.get(clean_url)
            status = int(resp.status)
            if not leader_data.get("ok"):
                return status != 200

            if status != 200:
                return False

            raw_text = resp.body.decode("utf-8", errors="replace")
            val_snippet, val_sha256 = _slice_snippet(raw_text, s_line, e_line)
            return bool(val_sha256 == leader_data.get("snippet_sha256"))

        result = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        payload = json.dumps(result)
        self.last_probe_json = payload
        return payload

    @gl.public.view
    def get_last_probe(self) -> str:
        return self.last_probe_json
