import { Controller, Get, Body, Patch, ParseIntPipe, Param, Req } from '@nestjs/common';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './entities/user.entity';

@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('getUserById/:id')
  getUserData(@Param('id', ParseIntPipe) id: number) {
    return this.userService.findOne(id);
  }

  @Patch()
  update(@Body() updateUserDto: UpdateUserDto) {
    return this.userService.update(updateUserDto);
  }

  @Get('login')
  async login(@Req() req: any) {
    const user: User | null = req.user;
    if (user == null) {
      const fireUser: any = req.fireUser;
      const newUser = new CreateUserDto();
      newUser.uid = fireUser.uid;
      newUser.email = fireUser.email;
      newUser.displayName = fireUser.name??fireUser.email;

      await this.userService.create(newUser);
      return this.userService.getUserByUid(fireUser.uid);
    } else {
      return this.userService.getUserByUid(user.uid);
    }
  }
}
