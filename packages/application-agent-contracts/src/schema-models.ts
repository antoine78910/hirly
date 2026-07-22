import { fromZod } from '@lssm-tech/lib.schema';
import { z } from 'zod';
/** The only bridge from Zod to ContractSpec; specs never receive raw Zod. */
export const contractSchema = <T extends z.ZodType>(schema: T, name: string) => fromZod(schema, { name });
