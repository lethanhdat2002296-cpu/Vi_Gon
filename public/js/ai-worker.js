// Web Worker chạy mô hình AI (WebLLM) tách khỏi luồng giao diện → app không bị đứng khi AI đang nghĩ.
// Cùng phiên bản thư viện với public/js/ai.js.
import { WebWorkerMLCEngineHandler } from 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/lib/index.js';

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg) => { handler.onmessage(msg); };
