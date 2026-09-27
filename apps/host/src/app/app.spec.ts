import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { HOST_CONFIG } from './host-config';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        {
          provide: HOST_CONFIG,
          useValue: { guestOrigin: 'http://localhost:5173', useEmulators: true },
        },
      ],
    }).compileComponents();
  });

  it('mounts the Guest iframe pointed at the configured guestOrigin', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const iframe = (fixture.nativeElement as HTMLElement).querySelector('iframe');
    expect(iframe).toBeTruthy();
    expect(iframe?.src).toContain('http://localhost:5173');
  });
});
