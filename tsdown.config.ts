import {defineConfig} from 'tsdown';

export default defineConfig({
  entry: {index: 'src/index.ts', server: 'src/server.ts', admin: 'src/admin.ts', react: 'src/react.tsx'},
  format: 'esm',
  platform: 'neutral',
  tsconfig: 'tsconfig.build.json',
  dts: true,
  clean: true,
});
