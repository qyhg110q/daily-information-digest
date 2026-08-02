export const MODEL_REGISTRY = [
  {
    id: "qwen3-asr-0.6b",
    name: "Qwen3-ASR 0.6B",
    provider: "Qwen",
    version: "0.6B",
    languages: ["zh", "en", "multilingual"],
    estimatedBytes: 2200000000,
    minimumVramGb: 4,
    recommendedVramGb: 6,
    source: { type: "modelscope", repository: "Qwen/Qwen3-ASR-0.6B" },
    licenseUrl: "https://modelscope.cn/models/Qwen/Qwen3-ASR-0.6B",
    backend: "qwen-asr",
    directory: "Qwen3-ASR-0.6B",
    requiredFiles: ["config.json"],
    recommendedChunkSeconds: 300,
    precision: "auto"
  }
];

export function getModel(id) {
  return MODEL_REGISTRY.find((model) => model.id === id);
}
