<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAuth } from '../composables/useAuth';

const router = useRouter();
const { logout, getAuthHeaders, isAuthenticated } = useAuth();

interface AppStats {
  name: string;
  icon: string;
  activeVisitors: number;
  todayPV: number;
  weeklyPV: { date: string; count: number }[];
}

const stats = ref<AppStats[]>([]);
const loading = ref(true);
const error = ref('');
const lastUpdated = ref('');
let refreshTimer: ReturnType<typeof setInterval> | null = null;

const APPS = [
  { key: 'it-tools', name: 'IT Tools', icon: '🛠️' },
  { key: 'excel-tools', name: 'EasyExcel', icon: '📊' },
];

async function fetchStats() {
  try {
    const res = await fetch('/api/stats/visitors', {
      headers: getAuthHeaders(),
    });
    if (res.status === 401) {
      logout();
      router.push('/admin/login');
      return;
    }
    const data = await res.json();
    if (res.ok) {
      stats.value = data.apps || [];
      error.value = '';
    } else {
      error.value = data.error || '获取数据失败';
    }
  } catch {
    error.value = '网络错误，请稍后重试';
  } finally {
    loading.value = false;
    lastUpdated.value = new Date().toLocaleTimeString('zh-CN');
  }
}

function handleLogout() {
  logout();
  router.push('/admin/login');
}

function formatDate(dateStr: string) {
  return dateStr.slice(5); // "2024-01-29" → "01-29"
}

function getBarHeight(count: number, maxCount: number) {
  if (maxCount === 0) return 0;
  return Math.max((count / maxCount) * 100, 2);
}

onMounted(() => {
  fetchStats();
  // Auto-refresh every 30 seconds
  refreshTimer = setInterval(fetchStats, 30_000);
});

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer);
});
</script>

<template>
  <div class="admin">
    <header class="admin-header">
      <div class="header-left">
        <h1>📋 管理后台</h1>
        <span class="update-hint" v-if="lastUpdated">上次更新: {{ lastUpdated }}</span>
      </div>
      <div class="header-right">
        <button class="refresh-btn" @click="fetchStats" :disabled="loading">🔄 刷新</button>
        <router-link to="/" class="back-link">← 首页</router-link>
        <button class="logout-btn" @click="handleLogout">退出登录</button>
      </div>
    </header>

    <main class="admin-content">
      <div v-if="loading && stats.length === 0" class="loading-state">
        <div class="spinner"></div>
        <p>加载统计数据中...</p>
      </div>

      <div v-else-if="error && stats.length === 0" class="error-state">
        <p>❌ {{ error }}</p>
        <button @click="fetchStats">重试</button>
      </div>

      <template v-else>
        <!-- Active Visitors Overview -->
        <section class="stats-section">
          <h2>👤 实时访客</h2>
          <div class="active-grid">
            <div
              v-for="app in stats"
              :key="app.name"
              class="active-card"
            >
              <div class="active-icon">{{ app.icon }}</div>
              <div class="active-info">
                <span class="active-count">{{ app.activeVisitors }}</span>
                <span class="active-label">{{ app.name }} 在线访客</span>
              </div>
              <div class="pulse-dot" v-if="app.activeVisitors > 0"></div>
            </div>
          </div>
        </section>

        <!-- Today's Page Views -->
        <section class="stats-section">
          <h2>📊 今日访问量</h2>
          <div class="pv-grid">
            <div
              v-for="app in stats"
              :key="app.name"
              class="pv-card"
            >
              <div class="pv-header">
                <span>{{ app.icon }} {{ app.name }}</span>
              </div>
              <div class="pv-count">{{ app.todayPV }}</div>
              <div class="pv-label">页面浏览量</div>
            </div>
          </div>
        </section>

        <!-- Weekly Trend -->
        <section class="stats-section">
          <h2>📈 近7天趋势</h2>
          <div class="trend-container">
            <div
              v-for="app in stats"
              :key="app.name"
              class="trend-card"
            >
              <div class="trend-header">{{ app.icon }} {{ app.name }}</div>
              <div class="trend-chart">
                <div
                  v-for="(day, idx) in app.weeklyPV"
                  :key="idx"
                  class="chart-bar-wrapper"
                >
                  <div
                    class="chart-bar"
                    :style="{
                      height: getBarHeight(day.count, Math.max(...app.weeklyPV.map(d => d.count), 1)) + '%'
                    }"
                    :title="`${formatDate(day.date)}: ${day.count} PV`"
                  ></div>
                  <span class="chart-label">{{ formatDate(day.date) }}</span>
                </div>
              </div>
              <div class="trend-total">
                7日合计: {{ app.weeklyPV.reduce((sum, d) => sum + d.count, 0) }} PV
              </div>
            </div>
          </div>
        </section>
      </template>
    </main>

    <footer class="admin-footer">
      <p>数据每30秒自动刷新 · Powered by Vercel KV</p>
    </footer>
  </div>
</template>

<style scoped>
.admin {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f0f2f5;
}

.admin-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  background: #fff;
  border-bottom: 1px solid #e5e7eb;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.header-left h1 {
  font-size: 1.3rem;
  color: #1a1a2e;
  margin: 0;
}

.update-hint {
  font-size: 0.75rem;
  color: #9ca3af;
  margin-left: 12px;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.refresh-btn,
.logout-btn {
  padding: 6px 14px;
  border: none;
  border-radius: 6px;
  font-size: 0.85rem;
  cursor: pointer;
  transition: background 0.2s;
}

.refresh-btn {
  background: #f3f4f6;
  color: #374151;
}

.refresh-btn:hover:not(:disabled) {
  background: #e5e7eb;
}

.refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.logout-btn {
  background: #fef2f2;
  color: #dc2626;
}

.logout-btn:hover {
  background: #fee2e2;
}

.back-link {
  color: #6b7280;
  font-size: 0.85rem;
  text-decoration: none;
}

.back-link:hover {
  color: #4f46e5;
}

.admin-content {
  flex: 1;
  max-width: 1100px;
  width: 100%;
  margin: 0 auto;
  padding: 24px;
}

.stats-section {
  margin-bottom: 28px;
}

.stats-section h2 {
  font-size: 1.1rem;
  color: #374151;
  margin-bottom: 14px;
}

/* Active Visitors */
.active-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

.active-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px;
  background: #fff;
  border-radius: 12px;
  border: 1px solid #e5e7eb;
  position: relative;
}

.active-icon {
  font-size: 2rem;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f3f4f6;
  border-radius: 10px;
}

.active-info {
  display: flex;
  flex-direction: column;
}

.active-count {
  font-size: 2rem;
  font-weight: 700;
  color: #1a1a2e;
  line-height: 1;
}

.active-label {
  font-size: 0.8rem;
  color: #6b7280;
  margin-top: 4px;
}

.pulse-dot {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 10px;
  height: 10px;
  background: #22c55e;
  border-radius: 50%;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4); }
  70% { box-shadow: 0 0 0 8px rgba(34, 197, 94, 0); }
  100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
}

/* Page Views */
.pv-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

.pv-card {
  padding: 20px;
  background: #fff;
  border-radius: 12px;
  border: 1px solid #e5e7eb;
}

.pv-header {
  font-size: 0.9rem;
  color: #374151;
  margin-bottom: 8px;
}

.pv-count {
  font-size: 2rem;
  font-weight: 700;
  color: #4f46e5;
  line-height: 1;
}

.pv-label {
  font-size: 0.8rem;
  color: #9ca3af;
  margin-top: 4px;
}

/* Weekly Trend */
.trend-container {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(480px, 1fr));
  gap: 16px;
}

@media (max-width: 540px) {
  .trend-container {
    grid-template-columns: 1fr;
  }
}

.trend-card {
  padding: 20px;
  background: #fff;
  border-radius: 12px;
  border: 1px solid #e5e7eb;
}

.trend-header {
  font-size: 0.9rem;
  color: #374151;
  margin-bottom: 16px;
  font-weight: 500;
}

.trend-chart {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  height: 120px;
  padding-bottom: 24px;
  position: relative;
}

.chart-bar-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
  justify-content: flex-end;
}

.chart-bar {
  width: 100%;
  max-width: 40px;
  background: linear-gradient(180deg, #818cf8 0%, #4f46e5 100%);
  border-radius: 4px 4px 0 0;
  min-height: 2px;
  transition: height 0.3s ease;
}

.chart-label {
  font-size: 0.65rem;
  color: #9ca3af;
  margin-top: 4px;
  white-space: nowrap;
}

.trend-total {
  font-size: 0.8rem;
  color: #6b7280;
  margin-top: 8px;
  text-align: right;
}

/* Loading / Error */
.loading-state,
.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 24px;
  color: #6b7280;
}

.spinner {
  width: 36px;
  height: 36px;
  border: 3px solid #e5e7eb;
  border-top-color: #4f46e5;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-bottom: 12px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error-state button {
  margin-top: 12px;
  padding: 8px 16px;
  background: #4f46e5;
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}

.admin-footer {
  text-align: center;
  padding: 16px;
  color: #9ca3af;
  font-size: 0.75rem;
  border-top: 1px solid #e5e7eb;
  background: #fff;
}
</style>
