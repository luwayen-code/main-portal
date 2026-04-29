<script setup lang="ts">
import { useAuth } from './composables/useAuth';

const { isAuthenticated } = useAuth();
</script>

<template>
  <router-view />
  <div v-if="!isAuthenticated" class="admin-entry">
    <a href="/admin/login">🔧 管理入口</a>
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

.admin-entry {
  position: fixed;
  bottom: 16px;
  right: 16px;
  z-index: 9999;
}

.admin-entry a {
  display: inline-block;
  padding: 6px 12px;
  background: rgba(0, 0, 0, 0.06);
  color: #9ca3af;
  border-radius: 6px;
  text-decoration: none;
  font-size: 0.75rem;
  transition: all 0.2s;
}

.admin-entry a:hover {
  background: rgba(0, 0, 0, 0.1);
  color: #6b7280;
}
</style>
