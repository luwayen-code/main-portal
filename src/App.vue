<script setup lang="ts">
interface AppItem {
  name: string;
  description: string;
  path: string;
  icon: string;
  color: string;
}

const apps: AppItem[] = [
  {
    name: 'IT Tools',
    description: '开发人员实用工具集，包含加密、转换、生成器等数十种在线工具',
    path: '/it-tools',
    icon: '🛠️',
    color: '#18a058',
  },
  {
    name: 'EasyExcel',
    description: 'Excel表格处理可视化工具，零代码完成数据清洗、汇总、格式检测等操作',
    path: '/excel-tools',
    icon: '📊',
    color: '#1a73e8',
  },
];
</script>

<template>
  <div class="portal">
    <header class="portal-header">
      <h1 class="portal-title">🧭 工具导航</h1>
      <p class="portal-subtitle">一站式访问所有项目与应用</p>
    </header>

    <main class="portal-content">
      <div class="app-grid">
        <a
          v-for="app in apps"
          :key="app.path"
          :href="app.path"
          class="app-card"
          :style="{ '--accent': app.color }"
        >
          <span class="app-icon">{{ app.icon }}</span>
          <div class="app-info">
            <h2 class="app-name">{{ app.name }}</h2>
            <p class="app-desc">{{ app.description }}</p>
          </div>
          <span class="app-arrow">→</span>
        </a>
      </div>

      <div class="empty-hint" v-if="apps.length === 0">
        暂无已注册的应用，请在 microfrontends.json 中配置
      </div>
    </main>

    <footer class="portal-footer">
      <p>Powered by Vercel Microfrontends</p>
    </footer>
  </div>
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  background: #f5f7fa;
  color: #333;
  min-height: 100vh;
}

.portal {
  max-width: 960px;
  margin: 0 auto;
  padding: 60px 24px 40px;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.portal-header {
  text-align: center;
  margin-bottom: 48px;
}

.portal-title {
  font-size: 2.5rem;
  font-weight: 700;
  color: #1a1a2e;
  margin-bottom: 8px;
}

.portal-subtitle {
  font-size: 1.1rem;
  color: #6b7280;
}

.portal-content {
  flex: 1;
}

.app-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
  gap: 20px;
}

@media (max-width: 480px) {
  .app-grid {
    grid-template-columns: 1fr;
  }
}

.app-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 24px;
  background: #fff;
  border-radius: 12px;
  text-decoration: none;
  color: inherit;
  border: 1px solid #e5e7eb;
  transition: all 0.2s ease;
  position: relative;
  overflow: hidden;
}

.app-card::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  background: var(--accent);
  border-radius: 4px 0 0 4px;
}

.app-card:hover {
  border-color: var(--accent);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  transform: translateY(-2px);
}

.app-icon {
  font-size: 2.2rem;
  flex-shrink: 0;
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f3f4f6;
  border-radius: 12px;
}

.app-info {
  flex: 1;
  min-width: 0;
}

.app-name {
  font-size: 1.15rem;
  font-weight: 600;
  color: #1a1a2e;
  margin-bottom: 4px;
}

.app-desc {
  font-size: 0.875rem;
  color: #6b7280;
  line-height: 1.4;
}

.app-arrow {
  font-size: 1.2rem;
  color: #9ca3af;
  flex-shrink: 0;
  transition: transform 0.2s ease, color 0.2s ease;
}

.app-card:hover .app-arrow {
  transform: translateX(4px);
  color: var(--accent);
}

.empty-hint {
  text-align: center;
  padding: 60px 24px;
  color: #9ca3af;
  font-size: 1rem;
}

.portal-footer {
  text-align: center;
  margin-top: 48px;
  padding-top: 24px;
  border-top: 1px solid #e5e7eb;
  color: #9ca3af;
  font-size: 0.8rem;
}
</style>
