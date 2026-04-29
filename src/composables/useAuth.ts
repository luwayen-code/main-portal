import { ref, computed } from 'vue';

const TOKEN_KEY = 'admin_token';

const token = ref<string | null>(localStorage.getItem(TOKEN_KEY));

export function useAuth() {
  const isAuthenticated = computed(() => {
    if (!token.value) return false;
    try {
      const exp = parseInt(token.value.split('.')[0], 10);
      return exp > Date.now();
    } catch {
      return false;
    }
  });

  function setToken(newToken: string) {
    token.value = newToken;
    localStorage.setItem(TOKEN_KEY, newToken);
  }

  function clearToken() {
    token.value = null;
    localStorage.removeItem(TOKEN_KEY);
  }

  function getAuthHeaders(): Record<string, string> {
    if (!token.value) return {};
    return { Authorization: `Bearer ${token.value}` };
  }

  async function login(password: string): Promise<{ success: boolean; error?: string }> {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (res.ok && data.token) {
        setToken(data.token);
        return { success: true };
      }
      return { success: false, error: data.error || '登录失败' };
    } catch {
      return { success: false, error: '网络错误，请稍后重试' };
    }
  }

  function logout() {
    clearToken();
  }

  return {
    token,
    isAuthenticated,
    login,
    logout,
    getAuthHeaders,
  };
}
