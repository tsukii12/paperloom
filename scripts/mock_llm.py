"""开发用 Mock LLM:模拟 OpenAI /chat/completions,验证翻译管线(不含真实翻译)。

用法:.venv/Scripts/python.exe scripts/mock_llm.py  (监听 127.0.0.1:9999)
测试时在设置页把 Base URL 填 http://127.0.0.1:9999/v1,API Key 随意。
"""
from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, HTTPServer


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length) or b"{}")
        user_msg = body.get("messages", [{}])[-1].get("content", "[]")
        try:
            items = json.loads(user_msg)
        except json.JSONDecodeError:
            items = []
        result = [
            {"id": it.get("id"), "text": "〔中译〕" + str(it.get("text", ""))}
            for it in items
            if isinstance(it, dict)
        ]
        content = json.dumps(result, ensure_ascii=False)
        resp = json.dumps(
            {
                "id": "mock",
                "choices": [{"index": 0, "message": {"role": "assistant", "content": content}}],
            },
            ensure_ascii=False,
        ).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(resp)))
        self.end_headers()
        self.wfile.write(resp)

    def log_message(self, *_args):
        pass


if __name__ == "__main__":
    HTTPServer(("127.0.0.1", 9999), Handler).serve_forever()
