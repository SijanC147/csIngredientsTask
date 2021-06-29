import { enableProdMode } from '@angular/core';
import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';

import Amplify from '@aws-amplify/core';
import { Auth } from '@aws-amplify/auth'
import awsconfig from './aws-exports';
Amplify.configure(awsconfig);

import { AppModule } from './app/app.module';
import { environment } from './environments/environment';

if (environment.production) {
  enableProdMode();
}

platformBrowserDynamic().bootstrapModule(AppModule)
  .catch(err => console.error(err));
