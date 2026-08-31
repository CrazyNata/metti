import { handleMcpRequest } from "./server.ts";

Deno.serve((request) => handleMcpRequest(request));
