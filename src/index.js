/**
 * opensin-swarm — Swarm intelligence for OpenSIN agents
 */
import { createLogger } from '@opensin/shared-helpers'
const log = createLogger('opensin-swarm')

class SwarmAgent {
  constructor() { this.agents = new Map(); this.tasks = new Map() }

  async addAgent(name, capabilities) {
    this.agents.set(name, { capabilities, status: 'active', tasksCompleted: 0 })
    log.info(`Swarm agent added: ${name}`)
  }

  async distributeTask(task) {
    const id = crypto.randomUUID()
    this.tasks.set(id, { task, assignedTo: [], status: 'pending', createdAt: Date.now() })
    log.info(`Swarm task created: ${id}`)
    return { id, status: 'pending' }
  }

  async assign(taskId, agentName) {
    const task = this.tasks.get(taskId)
    if (!task) return { error: 'Task not found' }
    task.assignedTo.push(agentName)
    task.status = 'in-progress'
    log.info(`Task ${taskId} assigned to ${agentName}`)
    return { taskId, agentName, status: 'assigned' }
  }

  async completeTask(taskId) {
    const task = this.tasks.get(taskId)
    if (!task) return { error: 'Task not found' }
    task.status = 'completed'
    task.completedAt = Date.now()
    for (const agent of task.assignedTo) {
      const a = this.agents.get(agent)
      if (a) a.tasksCompleted++
    }
    log.info(`Task ${taskId} completed`)
    return { taskId, status: 'completed' }
  }

  async getStatus() { return { agents: this.agents.size, tasks: this.tasks.size, completed: Array.from(this.tasks.values()).filter(t => t.status === 'completed').length } }
}

async function main() { const swarm = new SwarmAgent(); log.info('Swarm agent initialized') }
main().catch(console.error)
