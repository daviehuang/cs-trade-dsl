import { createRoot } from 'react-dom/client';
import App from './App';
import './app.css';
import './lookup-mock';   // 注入主数据查询后端（party-lookup 控件用）

createRoot(document.getElementById('root')!).render(<App />);
