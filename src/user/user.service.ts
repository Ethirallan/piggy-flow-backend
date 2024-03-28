import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './entities/user.entity';

@Injectable()
export class UserService {

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) { }

  create(createUserDto: CreateUserDto) {
    return this.userRepository.save(createUserDto);
  }

  async findOne(id: number) {
    try {
      const user = await this.userRepository.findOneOrFail({ where: { id: id } });
      return user;
    } catch (error) {
      throw new NotFoundException();
    }
  }

  async getUserByUid(id: string): Promise<User | null> {
    try {
      const user = await this.userRepository.findOneOrFail({ where: { uid: id } });
      return user;
    } catch (error) {
      return null;
    }
  }

  async getlUserWithRelationsById(id: number) {
    try {
      const user = await this.userRepository.createQueryBuilder('user')
        // .leftJoinAndSelect('user.bills', 'bill', 'bill.accountId IS NULL') // TODO: causes JS Heap out of memory
        .leftJoinAndSelect('user.categories', 'category', 'category.accountId IS NULL')
        .leftJoinAndSelect('user.shops', 'shop', 'shop.accountId IS NULL')
        .leftJoinAndSelect('user.subscriptions', 'subscription', 'subscription.accountId IS NULL')
        .where('user.id = :id', { id })
        .getOne();

      return user;
    } catch (error) {
      throw new NotFoundException();
    }
  }

  update(updateUserDto: UpdateUserDto) {
    return this.userRepository.save(updateUserDto);
  }
}
