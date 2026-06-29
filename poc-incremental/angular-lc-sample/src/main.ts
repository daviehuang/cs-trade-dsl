import { bootstrapApplication } from '@angular/platform-browser';
import { importProvidersFrom } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { ReactiveFormsModule } from '@angular/forms';
import { FormlyModule } from '@ngx-formly/core';

import { ShellComponent } from './app/shell.component';
import { ENGINE_FORMLY_TYPES, ENGINE_FORMLY_WRAPPERS } from './app/formly/engine-formly';

// 运行时按 featureId 拉取 RuleSet 需要 HttpClient；ngx-formly 版需要 ReactiveForms + 自定义类型注册。
bootstrapApplication(ShellComponent, {
  providers: [
    provideHttpClient(),
    importProvidersFrom(
      ReactiveFormsModule,
      FormlyModule.forRoot({ types: ENGINE_FORMLY_TYPES, wrappers: ENGINE_FORMLY_WRAPPERS }),
    ),
  ],
}).catch((err) => console.error(err));
