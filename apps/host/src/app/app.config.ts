import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideKlartextFirebase } from './firebase';

export const appConfig: ApplicationConfig = {
  providers: [provideBrowserGlobalErrorListeners(), ...provideKlartextFirebase()],
};
