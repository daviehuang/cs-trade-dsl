import { createApp } from 'vue';
import App from './App.vue';

import '../../ui-kit-react/src/styles.css';   // 复用共享的 eg-* 控件样式（四端同一份）
import './app.css';

createApp(App).mount('#app');
