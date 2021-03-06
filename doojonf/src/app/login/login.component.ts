import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from '../user-services/auth.service';
import { IdService, IdStatus } from '../user-services/id.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
})
export class LoginComponent implements OnInit, OnDestroy {
  loginForm = this._fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });
  isLoggining = false;

  private _uinfoSubs?: Subscription;

  constructor(
    private _id: IdService,
    private _auth: AuthService,
    private _router: Router,
    private _fb: FormBuilder,
    private _snackbar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this._uinfoSubs = this._id.getUserInfo().subscribe(uinfo => {
      if (uinfo?.status === IdStatus.AUTHORIZED) {
        return this._router.navigate([uinfo.profile?.username]);
      } else if (uinfo?.status === IdStatus.NOPROFILE) {
        return this._router.navigate(['/signup']);
      }

      return 1;
    });
  }

  ngOnDestroy() {
    this._uinfoSubs?.unsubscribe();
  }

  loginCanBeDone(): Boolean {
    if (this.isLoggining) return false;

    return this.loginForm.valid;
  }

  performLogin() {
    if (!this.loginForm.valid) return;
    const form = this.loginForm.value;

    this.isLoggining = true;
    this._auth.authWithPassword(form.email, form.password).subscribe(
      _ => {
        this.isLoggining = false;
        this._id.getUserInfo({ forceRefresh: true });
      },
      err => {
        this.isLoggining = false;
        this._snackbar.open('Sorry, authorization has failed', undefined, {duration: 5000})
      }
    );
  }
}
