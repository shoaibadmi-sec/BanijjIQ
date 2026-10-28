import { createApp } from 'vue';
import App from './App.vue';
import './styles.css';
import './ui-motion.css';
import './design/sher-tokens.css';
import './design/sher-components.css';
import './design/sher-compat.css';
import { installGlobalNumberInputBehavior } from './utils/numberInputBehavior';
import SortableHeader from './components/SortableHeader.vue';
import { sortRows } from './utils/tableSorting';

installGlobalNumberInputBehavior();

const app = createApp(App);
app.component('SortableHeader', SortableHeader);
app.config.globalProperties.$sortRows = sortRows;
app.mount('#app');
