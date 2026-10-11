import './styles/tokens.css';
import './styles/base.css';
import { mountApp } from './shell';

const root = document.querySelector<HTMLElement>('#app');

if (root === null) {
  throw new Error('Missing #app root element in index.html');
}

mountApp(root);
