import { Store } from './store.mjs';
import { HandoffService } from './service.mjs';
import { dataRoot } from './paths.mjs';
import { diagnose } from './diagnostics.mjs';
export function createRuntime(directory = dataRoot, options) {
  const store = new Store(directory);
  const service = new HandoffService(store, options);
  const routes = {
    connection: b => service.connection(b.target),
    doctor: () => diagnose(service),
    connect: b => service.connect(b.target),
    tasks: b => service.task(b),
    state: () => ({tasks:store.list('tasks'),handoffs:store.list('handoffs')}),
    conversations: b => service.conversations(b.taskId,b.target),
    inspect: b => service.inspect(b.conversationId,b.maxChars,b.target),
    route: b => service.route(b.taskId,b.target),
    preview: b => service.preview(b.taskId),
    send: b => service.send(b),
    transfer: b => service.transfer(b),
    check: b => service.wait(b.id,b.waitSeconds??0),
    supplement: b => service.supplement(b.id,b.text),
    open: b => service.open(b.conversationId,b.target),
    resolve: b => service.resolve(b.id,b.note),
  };
  return {store,service,close:()=>store.close(),dispatch:(operation,args={})=>{
    if(!Object.hasOwn(routes,operation))throw new Error('Unknown operation');
    return routes[operation](args);
  }};
}
