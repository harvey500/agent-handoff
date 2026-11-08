import fs from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const [name,file]=process.argv.slice(2);
const client=new Client({name:'source-agent-validation',version:'0.2.0'});
const transport=new StdioClientTransport({command:process.execPath,args:['src/mcp.mjs'],stderr:'pipe'});
try{
 await client.connect(transport);
 if(name==='inventory'){console.log(JSON.stringify({instructions:client.getInstructions(),tools:(await client.listTools()).tools.map(t=>t.name)}));}
 else{
  const args=file?JSON.parse(await fs.readFile(file,'utf8')):{};
  const response=await client.callTool({name,arguments:args},undefined,{timeout:60000});
  console.log(JSON.stringify(response));if(response.isError)process.exitCode=1;
 }
}finally{await client.close();await transport.close();}
