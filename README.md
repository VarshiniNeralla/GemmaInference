Since we are using vLLM by pulling the docker image, we should use wsl terminal as vllm is compatible with linux envnironments.

Ensure both the frontend and backend running in the wsl environment.


- Open docker desktop and run the gemma-vllm

- In wsl:
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 9000

- In wsl:
npm run dev



=========================
Initial gemma4 model card:

"Id": "f3d2def8d3ebf89ba796e57c74f9abf9aaf8ccdfbdeea44a34a3d4f2b83e754f",
	"Created": "2026-04-08T10:54:31.284071254Z",
	"Path": "vllm",
	"Args": [
		"serve",
		"--model",
		"RedHatAI/gemma-4-31B-it-NVFP4",
		"--served-model-name",
		"gemma4-31b",
		"--max-model-len",
		"32768",
		"--gpu-memory-utilization",
		"0.9",
		"--max-num-seqs",
		"16"
	]    
=========================
