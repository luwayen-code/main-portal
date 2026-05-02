<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAuth } from '../composables/useAuth';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line } from 'vue-chartjs';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
);

const router = useRouter();
const { logout, getAuthHeaders } = useAuth();

interface HourlyData {
  hour: number;
  count: number;
}

interface DailyHourlyData {
  date: string;
  hours: HourlyData[];
}

interface AppStats {
  name: string;
  icon: string;
  activeVisitors: number;
  todayPV: number;
  todayUV: number;
  todayHourlyPV: HourlyData[];
  todayHourlyUV: HourlyData[];
  weeklyPV: { date: string; count: number }[];
  weeklyUV: { date: string; count: number }[];
  weeklyHourlyPV: DailyHourlyData[];
  weeklyHourlyUV: DailyHourlyData[];
}

const stats = ref<AppStats[]>([]);
const loading = ref(true);
const error = ref('');
const lastUpdated = ref('');
const paused = ref(false);
const showClearConfirm = ref(false);
const clearing = ref(false);
const exporting = ref(false);
let refreshTimer: ReturnType<typeof setInterval> | null = null;

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
      paused.value = data.paused || false;
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

async function togglePause() {
  const newState = !paused.value;
  try {
    const res = await fetch('/api/stats/control', {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ paused: newState }),
    });
    const data = await res.json();
    if (res.ok) {
      paused.value = data.paused;
    } else {
      error.value = data.error || '操作失败';
    }
  } catch {
    error.value = '网络错误，请稍后重试';
  }
}

async function clearStats() {
  clearing.value = true;
  try {
    const res = await fetch('/api/stats/clear', {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
    });
    const data = await res.json();
    if (res.ok) {
      showClearConfirm.value = false;
      await fetchStats();
    } else {
      error.value = data.error || '清除失败';
    }
  } catch {
    error.value = '网络错误，请稍后重试';
  } finally {
    clearing.value = false;
  }
}

async function exportStats() {
  exporting.value = true;
  try {
    const res = await fetch('/api/stats/export', {
      headers: getAuthHeaders(),
    });
    if (res.ok) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const disposition = res.headers.get('content-disposition');
      const match = disposition?.match(/filename="([^"]+)"/);
      a.download = match ? match[1] : 'stats-export.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } else {
      const data = await res.json().catch(() => ({}));
      error.value = data.error || '导出失败';
    }
  } catch {
    error.value = '网络错误，请稍后重试';
  } finally {
    exporting.value = false;
  }
}

function formatDate(dateStr: string) {
  return dateStr.slice(5); // "2024-01-29" → "01-29"
}

function getBarHeight(count: number, maxCount: number) {
  if (maxCount === 0) return 0;
  return Math.max((count / maxCount) * 100, 2);
}

// --- Chart colors ---
const PV_COLOR = { line: 'rgba(79, 70, 229, 1)', fill: 'rgba(79, 70, 229, 0.08)' };
const UV_COLOR = { line: 'rgba(16, 185, 129, 1)', fill: 'rgba(16, 185, 129, 0.08)' };

// --- Today hourly chart (PV + UV dual lines) ---
function getTodayHourlyChartData(app: AppStats) {
  const labels = app.todayHourlyPV.map(d => `${d.hour}:00`);
  return {
    labels,
    datasets: [
      {
        label: 'PV',
        data: app.todayHourlyPV.map(d => d.count),
        borderColor: PV_COLOR.line,
        backgroundColor: PV_COLOR.fill,
        fill: true,
        tension: 0.4,
        pointRadius: 2,
        pointHoverRadius: 5,
        borderWidth: 2,
      },
      {
        label: 'UV',
        data: app.todayHourlyUV.map(d => d.count),
        borderColor: UV_COLOR.line,
        backgroundColor: UV_COLOR.fill,
        fill: true,
        tension: 0.4,
        pointRadius: 2,
        pointHoverRadius: 5,
        borderWidth: 2,
      },
    ],
  };
}

// --- Weekly daily line chart (PV + UV, 7 data points each) ---
function getWeeklyDailyChartData(app: AppStats) {
  const labels = app.weeklyPV.map(d => formatDate(d.date));
  return {
    labels,
    datasets: [
      {
        label: 'PV',
        data: app.weeklyPV.map(d => d.count),
        borderColor: PV_COLOR.line,
        backgroundColor: PV_COLOR.fill,
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointHoverRadius: 6,
        borderWidth: 2,
      },
      {
        label: 'UV',
        data: app.weeklyUV.map(d => d.count),
        borderColor: UV_COLOR.line,
        backgroundColor: UV_COLOR.fill,
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointHoverRadius: 6,
        borderWidth: 2,
      },
    ],
  };
}

// --- Weekly hourly chart (PV + UV dual lines, continuous timeline) ---
function getWeeklyHourlyChartData(app: AppStats) {
  const allLabels: string[] = [];
  const pvData: number[] = [];
  const uvData: number[] = [];

  for (const day of app.weeklyHourlyPV) {
    const shortDate = formatDate(day.date);
    const uvDay = app.weeklyHourlyUV.find(d => d.date === day.date);
    for (const h of day.hours) {
      allLabels.push(h.hour === 0 ? shortDate : `${h.hour}h`);
      pvData.push(h.count);
      uvData.push(uvDay?.hours.find(uh => uh.hour === h.hour)?.count || 0);
    }
  }

  return {
    labels: allLabels,
    datasets: [
      {
        label: 'PV',
        data: pvData,
        borderColor: PV_COLOR.line,
        backgroundColor: PV_COLOR.fill,
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 4,
        borderWidth: 2,
      },
      {
        label: 'UV',
        data: uvData,
        borderColor: UV_COLOR.line,
        backgroundColor: UV_COLOR.fill,
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 4,
        borderWidth: 2,
      },
    ],
  };
}

// --- Chart options ---
const dualLineChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: {
    mode: 'index' as const,
    intersect: false,
  },
  plugins: {
    legend: {
      display: true,
      position: 'top' as const,
      align: 'end' as const,
      labels: {
        boxWidth: 12,
        boxHeight: 12,
        borderRadius: 2,
        useBorderRadius: true,
        font: { size: 11 },
        padding: 12,
      },
    },
    tooltip: {
      backgroundColor: 'rgba(0,0,0,0.75)',
      titleFont: { size: 12 },
      bodyFont: { size: 12 },
      padding: 10,
      cornerRadius: 6,
    },
  },
  scales: {
    x: {
      grid: { display: false },
      ticks: { font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 13 },
    },
    y: {
      beginAtZero: true,
      grid: { color: 'rgba(0,0,0,0.05)' },
      ticks: { font: { size: 10 }, precision: 0 },
    },
  },
};

const weeklyDailyChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: {
    mode: 'index' as const,
    intersect: false,
  },
  plugins: {
    legend: {
      display: true,
      position: 'top' as const,
      align: 'end' as const,
      labels: {
        boxWidth: 12,
        boxHeight: 12,
        borderRadius: 2,
        useBorderRadius: true,
        font: { size: 11 },
        padding: 12,
      },
    },
    tooltip: {
      backgroundColor: 'rgba(0,0,0,0.75)',
      titleFont: { size: 12 },
      bodyFont: { size: 12 },
      padding: 10,
      cornerRadius: 6,
    },
  },
  scales: {
    x: {
      grid: { display: false },
      ticks: { font: { size: 10 }, maxRotation: 0 },
    },
    y: {
      beginAtZero: true,
      grid: { color: 'rgba(0,0,0,0.05)' },
      ticks: { font: { size: 10 }, precision: 0 },
    },
  },
};

const weeklyHourlyChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: {
    mode: 'index' as const,
    intersect: false,
  },
  plugins: {
    legend: {
      display: true,
      position: 'top' as const,
      align: 'end' as const,
      labels: {
        boxWidth: 12,
        boxHeight: 12,
        borderRadius: 2,
        useBorderRadius: true,
        font: { size: 11 },
        padding: 12,
      },
    },
    tooltip: {
      backgroundColor: 'rgba(0,0,0,0.75)',
      titleFont: { size: 12 },
      bodyFont: { size: 12 },
      padding: 10,
      cornerRadius: 6,
    },
  },
  scales: {
    x: {
      grid: { display: false },
      ticks: {
        font: { size: 10 },
        maxRotation: 0,
        autoSkip: true,
        maxTicksLimit: 7,
        callback(this: { getLabelForValue: (idx: number) => string }, _tick: { index: number }, label: string) {
          if (/^\d{2}-\d{2}$/.test(label)) return label;
          return '';
        },
      },
    },
    y: {
      beginAtZero: true,
      grid: { color: 'rgba(0,0,0,0.05)' },
      ticks: { font: { size: 10 }, precision: 0 },
    },
  },
};

onMounted(() => {
  fetchStats();
  fetchFeedbacks();
  // Auto-refresh every 30 seconds
  refreshTimer = setInterval(fetchStats, 30_000);
});

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer);
});

// --- Feedback management ---
const activeTab = ref<'stats' | 'feedback'>('stats');
const feedbacks = ref<any[]>([]);
const fbLoading = ref(false);
const fbError = ref('');
const replyingId = ref<string | null>(null);
const replyContent = ref('');

async function fetchFeedbacks() {
  fbLoading.value = true;
  fbError.value = '';
  try {
    const res = await fetch('/api/feedback/list', {
      headers: getAuthHeaders(),
    });
    if (res.status === 401) {
      logout();
      router.push('/admin/login');
      return;
    }
    const data = await res.json();
    if (res.ok) {
      feedbacks.value = data.feedbacks || [];
    } else {
      fbError.value = data.error || '获取反馈失败';
    }
  } catch {
    fbError.value = '网络错误';
  } finally {
    fbLoading.value = false;
  }
}

async function submitReply(id: string) {
  if (!replyContent.value.trim()) return;
  try {
    const res = await fetch('/api/feedback/reply', {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, reply: replyContent.value.trim() }),
    });
    const data = await res.json();
    if (res.ok && data.success) {
      replyingId.value = null;
      replyContent.value = '';
      await fetchFeedbacks();
    } else {
      fbError.value = data.error || '回复失败';
    }
  } catch {
    fbError.value = '网络错误';
  }
}

function formatFeedbackTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN');
}
</script>

<template>
  <div class="admin">
    <header class="admin-header">
      <div class="header-left">
        <h1>📋 管理后台</h1>
        <span class="update-hint" v-if="lastUpdated">上次更新: {{ lastUpdated }}</span>
        <span class="paused-badge" v-if="paused">⏸️ 统计已暂停</span>
      </div>
      <div class="header-right">
        <button class="pause-btn" @click="togglePause" :disabled="clearing || exporting">
          {{ paused ? '▶️ 恢复统计' : '⏸️ 暂停统计' }}
        </button>
        <button class="export-btn" @click="exportStats" :disabled="exporting || clearing">
          {{ exporting ? '导出中...' : '📥 导出数据' }}
        </button>
        <button class="clear-btn" @click="showClearConfirm = true" :disabled="clearing || exporting">
          🗑️ 清除数据
        </button>
        <button class="refresh-btn" @click="fetchStats" :disabled="loading">🔄 刷新</button>
        <router-link to="/" class="back-link">← 首页</router-link>
        <button class="logout-btn" @click="handleLogout">退出登录</button>
      </div>
    </header>

    <main class="admin-content">
      <!-- Tab Switcher -->
      <div class="tab-bar">
        <button :class="{ active: activeTab === 'stats' }" @click="activeTab = 'stats'">
          📊 访问统计
        </button>
        <button :class="{ active: activeTab === 'feedback' }" @click="activeTab = 'feedback'">
          💬 用户反馈 <span v-if="feedbacks.length" class="fb-badge">{{ feedbacks.length }}</span>
        </button>
      </div>

      <!-- Stats Tab -->
      <template v-if="activeTab === 'stats'">
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

        <!-- Today's Page Views & Unique Visitors -->
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
              <div class="pv-uv-row">
                <div class="pv-uv-item">
                  <div class="pv-count pv-color">{{ app.todayPV }}</div>
                  <div class="pv-label">页面浏览量 (PV)</div>
                </div>
                <div class="pv-uv-divider"></div>
                <div class="pv-uv-item">
                  <div class="pv-count uv-color">{{ app.todayUV }}</div>
                  <div class="pv-label">独立访客 (UV)</div>
                </div>
              </div>
              <!-- Hourly PV/UV Line Chart -->
              <div class="chart-container" v-if="app.todayHourlyPV && app.todayHourlyPV.length > 0">
                <Line :data="getTodayHourlyChartData(app)" :options="dualLineChartOptions" />
              </div>
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

              <!-- Daily Bar Chart -->
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

              <!-- Daily PV/UV Line Chart (7 data points) -->
              <div class="chart-sub-title">每日 PV / UV 趋势</div>
              <div class="chart-container weekly-daily-chart" v-if="app.weeklyPV.length > 0">
                <Line :data="getWeeklyDailyChartData(app)" :options="weeklyDailyChartOptions" />
              </div>

              <!-- Hourly PV/UV Line Chart for 7 days -->
              <div class="chart-sub-title">逐时访问详情</div>
              <div class="chart-container weekly-chart" v-if="app.weeklyHourlyPV && app.weeklyHourlyPV.length > 0">
                <Line :data="getWeeklyHourlyChartData(app)" :options="weeklyHourlyChartOptions" />
              </div>

              <div class="trend-total">
                7日合计: {{ app.weeklyPV.reduce((sum, d) => sum + d.count, 0) }} PV / {{ app.weeklyUV.reduce((sum, d) => sum + d.count, 0) }} UV
              </div>
            </div>
          </div>
        </section>
      </template>
      </template>

      <!-- Feedback Tab -->
      <template v-if="activeTab === 'feedback'">
        <div class="feedback-toolbar">
          <button class="refresh-btn" @click="fetchFeedbacks" :disabled="fbLoading">
            {{ fbLoading ? '刷新中...' : '🔄 刷新' }}
          </button>
        </div>

        <div v-if="fbLoading && feedbacks.length === 0" class="loading-state">
          <div class="spinner"></div>
          <p>加载反馈数据中...</p>
        </div>

        <div v-else-if="fbError && feedbacks.length === 0" class="error-state">
          <p>❌ {{ fbError }}</p>
          <button @click="fetchFeedbacks">重试</button>
        </div>

        <div v-else-if="feedbacks.length === 0" class="empty-state">
          <p>暂无用户反馈</p>
        </div>

        <div v-else class="feedback-list-admin">
          <div
            v-for="item in feedbacks"
            :key="item.id"
            class="feedback-card"
            :class="{ replied: item.status === 'replied' }"
          >
            <div class="feedback-card-header">
              <div class="feedback-card-meta">
                <span class="fb-type">{{ { bug: '🐛', feature: '✨', suggestion: '💡', other: '📝' }[item.type] || '📝' }}</span>
                <span class="fb-app">{{ item.app || 'excel-tools' }}</span>
                <span class="fb-contact">{{ item.contact }}</span>
                <span class="fb-time">{{ formatFeedbackTime(item.createdAt) }}</span>
              </div>
              <span class="fb-status" :class="item.status">{{ item.status === 'replied' ? '已回复' : '待处理' }}</span>
            </div>

            <div class="fb-content">{{ item.content }}</div>

            <div v-if="item.reply" class="fb-reply-box">
              <div class="fb-reply-label">管理员回复：</div>
              <div class="fb-reply-text">{{ item.reply.content }}</div>
              <div class="fb-reply-time">{{ formatFeedbackTime(item.reply.repliedAt) }}</div>
            </div>

            <div v-else class="fb-reply-actions">
              <button
                v-if="replyingId !== item.id"
                class="reply-toggle-btn"
                @click="replyingId = item.id; replyContent = ''"
              >
                ✏️ 回复
              </button>
              <div v-else class="reply-form">
                <textarea v-model="replyContent" rows="3" placeholder="请输入回复内容..."></textarea>
                <div class="reply-form-actions">
                  <button class="modal-cancel" @click="replyingId = null">取消</button>
                  <button class="modal-confirm" @click="submitReply(item.id)">提交回复</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </main>

    <footer class="admin-footer">
      <p>数据每30秒自动刷新 · Powered by XingWhy</p>
    </footer>

    <!-- Clear Confirm Modal -->
    <div v-if="showClearConfirm" class="modal-overlay" @click.self="showClearConfirm = false">
      <div class="modal-box">
        <h3>⚠️ 确认清除所有统计数据？</h3>
        <p>此操作将永久删除所有 PV、UV 及活跃访客数据，无法撤销。</p>
        <div class="modal-actions">
          <button class="modal-cancel" @click="showClearConfirm = false">取消</button>
          <button class="modal-confirm" @click="clearStats" :disabled="clearing">
            {{ clearing ? '清除中...' : '确认清除' }}
          </button>
        </div>
      </div>
    </div>
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

/* Page Views & UV */
.pv-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
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
  margin-bottom: 12px;
}

.pv-uv-row {
  display: flex;
  align-items: center;
  gap: 20px;
}

.pv-uv-item {
  display: flex;
  flex-direction: column;
}

.pv-uv-divider {
  width: 1px;
  height: 36px;
  background: #e5e7eb;
}

.pv-count {
  font-size: 2rem;
  font-weight: 700;
  line-height: 1;
}

.pv-color {
  color: #4f46e5;
}

.uv-color {
  color: #10b981;
}

.pv-label {
  font-size: 0.75rem;
  color: #9ca3af;
  margin-top: 4px;
}

.chart-container {
  position: relative;
  height: 200px;
  margin-top: 16px;
  padding-top: 8px;
  border-top: 1px solid #f3f4f6;
}

.weekly-daily-chart {
  height: 200px;
}

.weekly-chart {
  height: 240px;
  border-top: none;
  padding-top: 0;
}

.chart-sub-title {
  font-size: 0.75rem;
  color: #9ca3af;
  margin-top: 16px;
  margin-bottom: 0;
  padding-top: 12px;
  border-top: 1px solid #f3f4f6;
}

/* Weekly Trend */
.trend-container {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(520px, 1fr));
  gap: 16px;
}

@media (max-width: 580px) {
  .trend-container {
    grid-template-columns: 1fr;
  }
  .pv-grid {
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

.paused-badge {
  font-size: 0.75rem;
  color: #d97706;
  background: #fef3c7;
  padding: 2px 10px;
  border-radius: 100px;
  margin-left: 10px;
  font-weight: 500;
}

.pause-btn,
.export-btn,
.clear-btn {
  padding: 6px 14px;
  border: none;
  border-radius: 6px;
  font-size: 0.85rem;
  cursor: pointer;
  transition: background 0.2s;
}

.pause-btn {
  background: #fef3c7;
  color: #92400e;
}

.pause-btn:hover:not(:disabled) {
  background: #fde68a;
}

.export-btn {
  background: #dbeafe;
  color: #1e40af;
}

.export-btn:hover:not(:disabled) {
  background: #bfdbfe;
}

.clear-btn {
  background: #fee2e2;
  color: #991b1b;
}

.clear-btn:hover:not(:disabled) {
  background: #fecaca;
}

.pause-btn:disabled,
.export-btn:disabled,
.clear-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-box {
  background: #fff;
  border-radius: 12px;
  padding: 28px 32px;
  max-width: 420px;
  width: 90%;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15);
}

.modal-box h3 {
  margin: 0 0 10px;
  font-size: 1.1rem;
  color: #1a1a2e;
}

.modal-box p {
  margin: 0 0 24px;
  font-size: 0.9rem;
  color: #6b7280;
  line-height: 1.5;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.modal-cancel,
.modal-confirm {
  padding: 8px 18px;
  border: none;
  border-radius: 6px;
  font-size: 0.9rem;
  cursor: pointer;
  transition: background 0.2s;
}

.modal-cancel {
  background: #f3f4f6;
  color: #374151;
}

.modal-cancel:hover {
  background: #e5e7eb;
}

.modal-confirm {
  background: #dc2626;
  color: #fff;
}

.modal-confirm:hover:not(:disabled) {
  background: #b91c1c;
}

/* Tab Bar */
.tab-bar {
  display: flex;
  gap: 8px;
  margin-bottom: 24px;
  background: #fff;
  padding: 6px;
  border-radius: 10px;
  border: 1px solid #e5e7eb;
}

.tab-bar button {
  flex: 1;
  padding: 10px 16px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #6b7280;
  font-size: 0.9rem;
  cursor: pointer;
  transition: all 0.2s;
  font-weight: 500;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.tab-bar button.active {
  background: #1a1a2e;
  color: #fff;
}

.tab-bar button:not(.active):hover {
  background: #f3f4f6;
  color: #374151;
}

.fb-badge {
  background: #ef4444;
  color: white;
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 10px;
  font-weight: 600;
}

/* Feedback Admin */
.feedback-toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 16px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 24px;
  color: #9ca3af;
  font-size: 0.95rem;
  background: #fff;
  border-radius: 12px;
  border: 1px solid #e5e7eb;
}

.feedback-list-admin {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.feedback-card {
  background: #fff;
  border-radius: 12px;
  border: 1px solid #e5e7eb;
  padding: 20px;
  transition: box-shadow 0.2s;
}

.feedback-card:hover {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.05);
}

.feedback-card.replied {
  border-left: 4px solid #10b981;
}

.feedback-card:not(.replied) {
  border-left: 4px solid #f59e0b;
}

.feedback-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  flex-wrap: wrap;
  gap: 8px;
}

.feedback-card-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.fb-type {
  font-size: 1rem;
}

.fb-app {
  font-size: 0.8rem;
  color: #6b7280;
  background: #f3f4f6;
  padding: 2px 8px;
  border-radius: 4px;
}

.fb-contact {
  font-size: 0.8rem;
  color: #4f46e5;
  font-weight: 500;
}

.fb-time {
  font-size: 0.75rem;
  color: #9ca3af;
}

.fb-status {
  font-size: 0.75rem;
  padding: 3px 10px;
  border-radius: 100px;
  font-weight: 600;
}

.fb-status.open {
  background: #fef3c7;
  color: #92400e;
}

.fb-status.replied {
  background: #d1fae5;
  color: #065f46;
}

.fb-content {
  font-size: 0.9rem;
  color: #374151;
  line-height: 1.6;
  white-space: pre-wrap;
  margin-bottom: 14px;
}

.fb-reply-box {
  background: #f0fdf4;
  border-radius: 8px;
  padding: 14px;
  border: 1px solid #bbf7d0;
}

.fb-reply-label {
  font-size: 0.8rem;
  font-weight: 600;
  color: #065f46;
  margin-bottom: 6px;
}

.fb-reply-text {
  font-size: 0.9rem;
  color: #374151;
  line-height: 1.5;
  white-space: pre-wrap;
}

.fb-reply-time {
  font-size: 0.75rem;
  color: #9ca3af;
  margin-top: 6px;
}

.fb-reply-actions {
  margin-top: 4px;
}

.reply-toggle-btn {
  padding: 6px 14px;
  background: #eff6ff;
  color: #1d4ed8;
  border: 1px solid #bfdbfe;
  border-radius: 6px;
  font-size: 0.85rem;
  cursor: pointer;
  transition: background 0.2s;
}

.reply-toggle-btn:hover {
  background: #dbeafe;
}

.reply-form {
  margin-top: 8px;
}

.reply-form textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-size: 0.9rem;
  resize: vertical;
  font-family: inherit;
}

.reply-form textarea:focus {
  outline: none;
  border-color: #4f46e5;
}

.reply-form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 10px;
}

.reply-form-actions .modal-cancel,
.reply-form-actions .modal-confirm {
  padding: 7px 16px;
}

.reply-form-actions .modal-confirm {
  background: #4f46e5;
}

.reply-form-actions .modal-confirm:hover:not(:disabled) {
  background: #4338ca;
}
</style>
