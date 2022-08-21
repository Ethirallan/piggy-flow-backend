import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response } from 'express';
import * as firebase from 'firebase-admin';
import { User } from 'src/user/entities/user.entity';
import { UserService } from 'src/user/user.service';
const credential = require('../../firebase.json');

@Injectable()
export class AuthMiddleware implements NestMiddleware {

  private defaultApp: any;

  constructor(
    private userService: UserService,
  ) {
    this.defaultApp = firebase.initializeApp({
      credential: firebase.credential.cert(credential),
    });
  }

  use(req: Request, res: Response, next: Function) {
    const token = req.headers.authorization;

    if (token != null && token != '') {
      this.defaultApp.auth().verifyIdToken(token.replace('Bearer ', ''))
        .then(async (fireUser: any) => {

          let user: User | null = await this.userService.getUserByUid(fireUser.uid);
          if (user == null) {
            req['fireUser'] = fireUser;
          }
          req['user'] = user;
          next();
        }).catch(error => {
          console.error(error);
          this.accessDenied(req.url, res);
        });
    } else {
      this.accessDenied(req.url, res);
    }
  }

  private accessDenied(url: string, res: Response) {
    res.status(403).json({
      statusCode: 403,
      timestamp: new Date().toISOString(),
      path: url,
      message: 'Access Denied'
    });
  }
}
