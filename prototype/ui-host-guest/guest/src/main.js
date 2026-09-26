import { createApp } from 'vue';
import App from './App.vue';
import '../../shared/theme.css';
import './style.css';

createApp(App).mount('#app');

window.parent.postMessage({ v: 1, type: 'GUEST_READY', sessionId: 'proto' }, '*');
