/**
 * Task Tracker - 任務追蹤機制
 */

class TaskTracker {
  constructor() {
    this.tasks = new Map();
    this.taskIdCounter = 1;
  }

  /**
   * 創建新任務
   */
  createTask(userId, type, metadata = {}) {
    const taskId = this.taskIdCounter++;
    const task = {
      id: taskId,
      userId,
      type,
      status: 'pending',
      progress: 0,
      progressText: '準備中...',
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata,
      result: null,
      error: null,
    };
    this.tasks.set(taskId, task);
    return task;
  }

  /**
   * 更新任務進度
   */
  updateProgress(taskId, progress, progressText) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.progress = progress;
      task.progressText = progressText;
      task.status = 'running';
      task.updatedAt = new Date();
    }
    return task;
  }

  /**
   * 完成任務
   */
  completeTask(taskId, result) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = 'completed';
      task.progress = 100;
      task.progressText = '完成';
      task.result = result;
      task.updatedAt = new Date();
    }
    return task;
  }

  /**
   * 任務失敗
   */
  failTask(taskId, error) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = 'failed';
      task.progressText = '失敗';
      task.error = error;
      task.updatedAt = new Date();
    }
    return task;
  }

  /**
   * 取得用戶的任務
   */
  getUserTasks(userId, includeCompleted = false) {
    const userTasks = [];
    for (const task of this.tasks.values()) {
      if (task.userId === userId) {
        if (includeCompleted || task.status === 'pending' || task.status === 'running') {
          userTasks.push(task);
        }
      }
    }
    return userTasks.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * 取得任務
   */
  getTask(taskId) {
    return this.tasks.get(taskId);
  }

  /**
   * 取得進行中的任務
   */
  getRunningTasks() {
    const running = [];
    for (const task of this.tasks.values()) {
      if (task.status === 'pending' || task.status === 'running') {
        running.push(task);
      }
    }
    return running;
  }

  /**
   * 格式化任務狀態
   */
  formatTaskStatus(task) {
    const statusEmoji = {
      pending: '⏳',
      running: '🔄',
      completed: '✅',
      failed: '❌',
    };

    const elapsed = Math.floor((new Date() - task.createdAt) / 1000);
    const elapsedStr = elapsed < 60 ? `${elapsed}秒` : `${Math.floor(elapsed / 60)}分${elapsed % 60}秒`;

    return `${statusEmoji[task.status]} **任務 #${task.id}** - ${task.type}\n` +
           `狀態：${task.progressText}\n` +
           `進度：${task.progress}%\n` +
           `耗時：${elapsedStr}`;
  }

  /**
   * 清理舊任務（保留最近 50 個）
   */
  cleanup() {
    if (this.tasks.size > 100) {
      const sorted = Array.from(this.tasks.entries())
        .sort((a, b) => b[1].createdAt - a[1].createdAt);

      const toKeep = sorted.slice(0, 50);
      this.tasks = new Map(toKeep);
    }
  }
}

export const taskTracker = new TaskTracker();
export default TaskTracker;
