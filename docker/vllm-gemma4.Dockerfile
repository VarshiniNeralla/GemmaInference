# Extend official vLLM image with Transformers that knows `gemma4` (Gemma 4 checkpoints).
# Base image alone often ships Transformers that predates Gemma 4 model_type registration.
#
# Build:  docker build -f docker/vllm-gemma4.Dockerfile -t vllm-gemma4:local .
# Run:    (see setup_guide.md)

FROM vllm/vllm-openai:nightly

# Install Transformers from GitHub main when releases lag behind new architectures.
# If this ever conflicts with vLLM, pin a recent transformers release instead, e.g.:
#   RUN pip install --no-cache-dir "transformers>=4.52.0"
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir git+https://github.com/huggingface/transformers.git
