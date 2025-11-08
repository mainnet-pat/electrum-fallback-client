import { UseCase } from './interfaces';
import getTransaction from './getTransaction';

export { UseCase } from './interfaces';
export const useCases: { [index: string]: UseCase } =
{
	getTransaction,
};
