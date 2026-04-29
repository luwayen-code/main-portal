import { createRouter, createWebHistory } from 'vue-router';
import Home from './views/Home.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'Home',
      component: Home,
    },
    {
      path: '/admin/login',
      name: 'AdminLogin',
      component: () => import('./views/AdminLogin.vue'),
    },
    {
      path: '/admin',
      name: 'AdminDashboard',
      component: () => import('./views/AdminDashboard.vue'),
      meta: { requiresAuth: true },
    },
  ],
});

router.beforeEach((to) => {
  if (to.meta.requiresAuth) {
    const token = localStorage.getItem('admin_token');
    if (!token) {
      return { name: 'AdminLogin', query: { redirect: to.fullPath } };
    }
    // Check if token is expired
    try {
      const exp = parseInt(token.split('.')[0], 10);
      if (exp < Date.now()) {
        localStorage.removeItem('admin_token');
        return { name: 'AdminLogin', query: { redirect: to.fullPath } };
      }
    } catch {
      localStorage.removeItem('admin_token');
      return { name: 'AdminLogin', query: { redirect: to.fullPath } };
    }
  }
});

export default router;
